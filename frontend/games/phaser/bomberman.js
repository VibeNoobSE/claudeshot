registerGame("bomberman", "💣 Bomberman", "WASD+SPACE = P1, Arrows+ENTER = P2", "Blow up your opponent!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a1a");
    const gs=40;this.gs=gs;
    this.walls=this.physics.add.staticGroup();this.crates=this.physics.add.staticGroup();
    // Grid walls
    for(let r=0;r<Math.floor(H/gs);r++)for(let c=0;c<Math.floor(W/gs);c++){
      const x=c*gs+gs/2,y=r*gs+gs/2;
      if(r===0||c===0||r===Math.floor(H/gs)-1||c===Math.floor(W/gs)-1){this.walls.add(this.add.rectangle(x,y,gs-2,gs-2,0x555555));}
      else if(r%2===0&&c%2===0){this.walls.add(this.add.rectangle(x,y,gs-2,gs-2,0x555555));}
      else if(Math.random()<0.4&&!((r<3&&c<3)||(r>8&&c>16))){this.crates.add(this.add.rectangle(x,y,gs-2,gs-2,0x886644));}
    }
    this.p1=this.add.rectangle(gs*1.5,gs*1.5,20,20,0xf7c948);this.p2=this.add.rectangle(W-gs*1.5,H-gs*1.5,20,20,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);});
    this.physics.add.collider(this.p1,this.walls);this.physics.add.collider(this.p2,this.walls);
    this.physics.add.collider(this.p1,this.crates);this.physics.add.collider(this.p2,this.crates);
    this.blasts=this.physics.add.group();
    this.physics.add.overlap(this.blasts,this.p1,()=>{if(!this.over){this.over=true;this.add.text(W/2,H/2,"P2 WINS!",{fontSize:"36px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}});
    this.physics.add.overlap(this.blasts,this.p2,()=>{if(!this.over){this.over=true;this.add.text(W/2,H/2,"P1 WINS!",{fontSize:"36px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);}});
    this.physics.add.overlap(this.blasts,this.crates,(bl,cr)=>cr.destroy());
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",space:"SPACE",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT",enter:Phaser.Input.Keyboard.KeyCodes.ENTER});
    this.lb1=0;this.lb2=0;this.over=false;
  }
  bomb(x,y,t){
    if(t<0)return;const gs=this.gs;
    const bx=Math.round((x-gs/2)/gs)*gs+gs/2,by=Math.round((y-gs/2)/gs)*gs+gs/2;
    const bomb=this.add.circle(bx,by,10,0xff4444);
    this.time.delayedCall(2000,()=>{bomb.destroy();
      [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]].forEach(([dx,dy])=>{
        const bl=this.add.rectangle(bx+dx*gs,by+dy*gs,gs-4,gs-4,0xff6600);bl.setAlpha(0.7);this.blasts.add(bl);this.physics.add.existing(bl);
        this.time.delayedCall(300,()=>bl.destroy());
      });
    });
  }
  update(t){if(this.over)return;const s=180,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    if(k.space.isDown&&t>this.lb1+1500){this.lb1=t;this.bomb(this.p1.x,this.p1.y,t);}
    if(k.enter.isDown&&t>this.lb2+1500){this.lb2=t;this.bomb(this.p2.x,this.p2.y,t);}
  }
});
