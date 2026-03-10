registerGame("snowball", "❄️ Snowball Fight", "WASD+SPACE = P1, Arrows+ENTER = P2", "Hit your opponent with snowballs!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#d8e8f8");
    // Trees as cover
    [[200,150],[400,300],[600,150],[300,400],[500,100]].forEach(([x,y])=>{this.add.triangle(x,y-20,0,30,-20,30,20,30,0x2a6a2a);this.add.rectangle(x,y+10,8,20,0x664422);});
    this.forts=this.physics.add.staticGroup();
    this.forts.add(this.add.rectangle(100,H/2,20,80,0xaabbcc));this.forts.add(this.add.rectangle(W-100,H/2,20,80,0xaabbcc));
    this.p1=this.add.circle(60,H/2,12,0x4466cc);this.p2=this.add.circle(W-60,H/2,12,0xcc4444);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);p.setData("hp",5);});
    this.physics.add.collider(this.p1,this.forts);this.physics.add.collider(this.p2,this.forts);
    this.balls=this.physics.add.group();this.physics.add.collider(this.balls,this.forts,(b)=>b.destroy());
    this.physics.add.overlap(this.balls,this.p1,(p,b)=>{if(b.getData("o")==="P1")return;b.destroy();this.hit(p,"P1");});
    this.physics.add.overlap(this.balls,this.p2,(p,b)=>{if(b.getData("o")==="P2")return;b.destroy();this.hit(p,"P2");});
    this.hp1=this.add.text(16,16,"P1: 5",{fontSize:"18px",color:"#4466cc",fontFamily:"monospace"});
    this.hp2=this.add.text(W-100,16,"P2: 5",{fontSize:"18px",color:"#cc4444",fontFamily:"monospace"});
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",space:"SPACE",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT",enter:Phaser.Input.Keyboard.KeyCodes.ENTER});
    this.ls1=0;this.ls2=0;this.over=false;
  }
  hit(p,label){const hp=p.getData("hp")-1;p.setData("hp",hp);(label==="P1"?this.hp1:this.hp2).setText(label+": "+hp);
    if(hp<=0&&!this.over){this.over=true;this.add.text(W/2,H/2,(label==="P1"?"P2":"P1")+" WINS!",{fontSize:"36px",color:"#333",fontFamily:"monospace"}).setOrigin(0.5);}}
  update(t){if(this.over)return;const s=200,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    if(k.space.isDown&&t>this.ls1+500){this.ls1=t;const b=this.add.circle(this.p1.x,this.p1.y,6,0xffffff);this.balls.add(b);this.physics.add.existing(b);b.body.setVelocity(300,0);b.setData("o","P1");this.time.delayedCall(2000,()=>b.destroy());}
    if(k.enter.isDown&&t>this.ls2+500){this.ls2=t;const b=this.add.circle(this.p2.x,this.p2.y,6,0xffffff);this.balls.add(b);this.physics.add.existing(b);b.body.setVelocity(-300,0);b.setData("o","P2");this.time.delayedCall(2000,()=>b.destroy());}
  }
});
