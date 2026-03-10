registerGame("capture-flag", "🚩 Capture the Flag", "WASD = P1, Arrows = P2", "Steal the enemy flag and bring it home!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a2a2e");
    this.add.rectangle(W/4,H/2,W/2-10,H,0x1a2a3e);this.add.rectangle(W*3/4,H/2,W/2-10,H,0x2e1a1a);
    this.add.rectangle(W/2,H/2,4,H,0x888888);
    this.f1=this.add.triangle(60,H/2,0,-15,10,10,-10,10,0xf7c948);this.f2=this.add.triangle(W-60,H/2,0,-15,10,10,-10,10,0xe94560);
    this.p1=this.add.circle(100,H/2,14,0xf7c948);this.p2=this.add.circle(W-100,H/2,14,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);p.setData("hasFlag",false);});
    this.physics.add.collider(this.p1,this.p2);
    this.s1=0;this.s2=0;
    this.sTxt=this.add.text(W/2,16,"P1: 0 | P2: 0 (first to 3)",{fontSize:"18px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.over=false;
  }
  update(){if(this.over)return;const s=250,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    // P1 grabs P2's flag
    if(!this.p1.getData("hasFlag")&&Phaser.Math.Distance.Between(this.p1.x,this.p1.y,this.f2.x,this.f2.y)<30){this.p1.setData("hasFlag",true);this.f2.setVisible(false);}
    // P2 grabs P1's flag
    if(!this.p2.getData("hasFlag")&&Phaser.Math.Distance.Between(this.p2.x,this.p2.y,this.f1.x,this.f1.y)<30){this.p2.setData("hasFlag",true);this.f1.setVisible(false);}
    // P1 scores
    if(this.p1.getData("hasFlag")&&this.p1.x<W/2-50){this.s1++;this.p1.setData("hasFlag",false);this.f2.setVisible(true);this.reset();}
    // P2 scores
    if(this.p2.getData("hasFlag")&&this.p2.x>W/2+50){this.s2++;this.p2.setData("hasFlag",false);this.f1.setVisible(true);this.reset();}
    // Tag — if on enemy side and touched, drop flag
    if(this.p1.x>W/2&&Phaser.Math.Distance.Between(this.p1.x,this.p1.y,this.p2.x,this.p2.y)<30){this.p1.setData("hasFlag",false);this.f2.setVisible(true);this.p1.setPosition(100,H/2);}
    if(this.p2.x<W/2&&Phaser.Math.Distance.Between(this.p1.x,this.p1.y,this.p2.x,this.p2.y)<30){this.p2.setData("hasFlag",false);this.f1.setVisible(true);this.p2.setPosition(W-100,H/2);}
    this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);
    if(this.s1>=3||this.s2>=3){this.over=true;this.add.text(W/2,H/2,(this.s1>=3?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
  }
  reset(){this.p1.setPosition(100,H/2);this.p2.setPosition(W-100,H/2);}
});
