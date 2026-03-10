registerGame("paint-battle", "🎨 Paint Battle", "WASD = P1, Arrows = P2", "Cover the most ground in your color!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#222222");
    this.gfx=this.add.graphics();this.grid={};this.s1=0;this.s2=0;
    this.p1=this.add.circle(100,H/2,10,0xf7c948);this.p2=this.add.circle(W-100,H/2,10,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);});
    this.physics.add.collider(this.p1,this.p2);
    this.sTxt=this.add.text(W/2,10,"P1: 0 | P2: 0",{fontSize:"16px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.timeLeft=20;
    this.timeTxt=this.add.text(W/2,H-14,this.timeLeft+"s",{fontSize:"14px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.time.addEvent({delay:1000,callback:()=>{if(--this.timeLeft<=0){this.physics.pause();this.add.text(W/2,H/2,(this.s1>this.s2?"P1":"P2")+" WINS! ("+Math.max(this.s1,this.s2)+" tiles)",{fontSize:"28px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}this.timeTxt.setText(this.timeLeft+"s");},loop:true});
  }
  paint(x,y,team){
    const gx=Math.floor(x/10)*10,gy=Math.floor(y/10)*10,key=gx+","+gy;
    const prev=this.grid[key];
    if(prev===team)return;
    if(prev===0)this.s1--;else if(prev===1)this.s2--;
    this.grid[key]=team;if(team===0)this.s1++;else this.s2++;
    this.gfx.fillStyle(team===0?0xf7c948:0xe94560,0.6);this.gfx.fillRect(gx,gy,10,10);
    this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);
  }
  update(){const s=250,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    this.paint(this.p1.x,this.p1.y,0);this.paint(this.p2.x,this.p2.y,1);
  }
});
